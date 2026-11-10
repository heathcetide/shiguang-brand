import { useEffect, useRef, useState } from "react";
import { ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { planMaintenanceSettingsSchema, planMaintenanceStateSchema, type PlanMaintenanceState } from "@dietdigidose/contracts";
import { Screen } from "@/components/Screen";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { requestJson } from "@/services/api/client";

export default function PlanMaintenanceScreen() {
  const { user } = useAuth(); const authFetch = useAuthFetch(); const router = useSafeRouter();
  const [saved,setSaved] = useState<{ owner: number; value: PlanMaintenanceState } | null>(null);
  const [enabled,setEnabled] = useState(false); const [time,setTime] = useState(""); const [zone,setZone] = useState("");
  const [busy,setBusy] = useState(false); const [message,setMessage] = useState(""); const [reload,setReload] = useState(0);
  const owner = useRef(user?.id); owner.current = user?.id;
  const sequence = useRef(0); const writing = useRef(false);
  const state = saved?.owner === user?.id ? saved?.value : null;
  const adopt = (id: number,value: PlanMaintenanceState) => {
    setSaved({ owner: id,value }); setEnabled(value.enabled); setTime(value.localTime ?? ""); setZone(value.timeZone ?? "");
  };
  useEffect(() => {
    const ticket = ++sequence.current; const id = user?.id;
    writing.current = false; setSaved(null); setBusy(Boolean(id)); setMessage(""); setTime(""); setZone(""); setEnabled(false);
    if (id) void requestJson(authFetch,"/api/v1/plan-maintenance/settings",{},planMaintenanceStateSchema)
      .then(value => { if (sequence.current === ticket && owner.current === id) adopt(id,value); })
      .catch(() => { if (sequence.current === ticket && owner.current === id) setMessage("未能读取设置，请重新读取后再修改。"); })
      .finally(() => { if (sequence.current === ticket && owner.current === id) setBusy(false); });
    return () => { sequence.current++; };
  },[user?.id,authFetch,reload]);
  const save = async () => {
    if (!state || !user || busy || writing.current) return;
    const parsed = planMaintenanceSettingsSchema.safeParse(enabled ? { version: state.version,enabled: true,localTime: time.trim(),timeZone: zone.trim() } : { version: state.version,enabled: false });
    if (!parsed.success) { setMessage(parsed.error.issues[0]?.message ?? "请核对检查时间和时区"); return; }
    const id = user.id; const ticket = ++sequence.current;
    writing.current = true; setBusy(true); setMessage("");
    try {
      const value = await requestJson(authFetch,"/api/v1/plan-maintenance/settings",{ method: "PATCH",body: JSON.stringify(parsed.data) },planMaintenanceStateSchema);
      if (sequence.current === ticket && owner.current === id) { adopt(id,value); setMessage("设置已保存"); }
    } catch {
      if (sequence.current === ticket && owner.current === id) { setSaved(null); setMessage("保存结果尚未确认，或设置已在其他地方更新。请重新读取后核对。"); }
    } finally {
      if (sequence.current === ticket && owner.current === id) { writing.current = false; setBusy(false); }
    }
  };
  const nextCheck = state?.nextCheckAt && state.timeZone ? new Intl.DateTimeFormat("zh-CN",{ timeZone: state.timeZone,year: "numeric",month: "2-digit",day: "2-digit",hour: "2-digit",minute: "2-digit",hourCycle: "h23" }).format(new Date(state.nextCheckAt)) : null;
  return <Screen className="flex-1 bg-background">
    <View className="flex-row items-center gap-6 p-5"><TouchableOpacity accessibilityRole="button" onPress={() => router.back()}><Text className="text-brand">返回</Text></TouchableOpacity><Text className="text-xl font-bold text-ink">每日计划检查</Text></View>
    <ScrollView contentContainerClassName="p-5 gap-4">
      <TouchableOpacity accessibilityRole="button" onPress={() => router.push("/maintenance-results")}><Text className="font-bold text-brand">查看计划检查结果</Text></TouchableOpacity>
      <Text className="text-copy-muted">每天核对未来餐次的库存和安排。未确认餐次可以调整；已确认或采购的餐次先给出建议，制作中的餐次保持不动。</Text>
      {!user ? <Text className="text-ink">请登录后设置每日检查。</Text> : <>
        {state ? <>
          <View className="flex-row items-center justify-between rounded-xl bg-surface p-4"><Text className="font-bold text-ink">启用每日检查</Text><Switch accessibilityLabel="启用每日检查" value={enabled} disabled={busy} onValueChange={setEnabled} /></View>
          {enabled ? <>
            <Text className="text-ink">检查时间（24小时制，例如 20:30）</Text>
            <TextInput accessibilityLabel="每日检查时间" value={time} onChangeText={setTime} editable={!busy} placeholder="HH:mm" maxLength={5} autoCorrect={false} className="rounded-xl border border-border bg-surface p-4 text-ink" />
            <Text className="text-ink">时区（例如 Asia/Shanghai）</Text>
            <TextInput accessibilityLabel="每日检查时区" value={zone} onChangeText={setZone} editable={!busy} placeholder="Asia/Shanghai" autoCapitalize="none" autoCorrect={false} className="rounded-xl border border-border bg-surface p-4 text-ink" />
            <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => { try { setZone(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { setMessage("未能读取设备时区，请手动填写。"); } }}><Text className="text-brand">使用当前设备时区</Text></TouchableOpacity>
          </> : <Text className="text-copy-muted">关闭仅停止每日定时检查；入库、制作和食用等变化仍会触发相关餐次核对。</Text>}
          <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => void save()} className="rounded-xl bg-brand p-4"><Text className="text-center font-bold text-white">{busy ? "正在保存…" : "保存设置"}</Text></TouchableOpacity>
          <Text className="text-copy-muted">已保存状态：{state.enabled ? "已开启" : "已关闭"}</Text>
          {state.enabled && nextCheck ? <Text className="text-copy-muted">下次计划检查：{nextCheck}（{state.timeZone}）。后台到期后执行，可能稍有延迟。</Text> : null}
          {state.lastCompletedLocalDate ? <Text className="text-copy-muted">最近完成的检查日：{state.lastCompletedLocalDate}</Text> : null}
        </> : busy ? <Text className="text-copy-muted">正在读取设置…</Text> : null}
        {message ? <Text accessibilityLiveRegion="polite" className="text-ink">{message}</Text> : null}
        <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => setReload(value => value+1)}><Text className="text-brand">重新读取已保存设置</Text></TouchableOpacity>
      </>}
    </ScrollView>
  </Screen>;
}
